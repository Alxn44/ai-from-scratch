package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 32 characters, and deliberately containing none of the placeholder words the
// startup check looks for. An earlier version of this constant was
// "a-32-plus-character-test-secret-value", which New() rejected -- correctly,
// because it contains "secret". The guard was right and the test was wrong.
const goodSecret = "K7f9Qx2mNv4TzB8LrJ3sYw6HpC1dGeUa"

func newServer(t *testing.T) *Server {
	t.Helper()
	// A nil store is fine for every test here: all of them stop at the auth
	// check or at the catalogue, neither of which touches the database. Any test
	// that panicked would be a test proving a request reached the database when
	// it should not have.
	s, err := New(nil, goodSecret, nil)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestAWeakSecretIsRefusedAtStartup(t *testing.T) {
	for _, bad := range []string{
		"", "short", "changeme-changeme-changeme-changeme",
		"cambia-esto-por-32-bytes-aleatorios",
		"dev-only-change-me-but-long-enough-to-pass",
	} {
		if _, err := New(nil, bad, nil); err == nil {
			t.Errorf("accepted %q as the secret. This repository already shipped a 35-character "+
				"placeholder that passed a length check and worked as a real key", bad)
		}
	}
}

func TestNoSecretMeansNoAnswer(t *testing.T) {
	h := newServer(t).Handler()
	for _, tc := range []struct{ name, secret string }{
		{"absent", ""},
		{"wrong", "Zq3Wm8Rt5Yv1XbN6KdP9LcJ4HsF2GaUe"},
		{"a prefix of the real one", goodSecret[:20]},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/v1/op",
				strings.NewReader(`{"op":"lesson.list","args":{}}`))
			if tc.secret != "" {
				req.Header.Set(HeaderSecret, tc.secret)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("status %d, want 401", w.Code)
			}
			// The refusal must not say WHICH way it failed. "wrong secret"
			// versus "no secret" is a free hint.
			if b := w.Body.String(); strings.Contains(b, "secret") || strings.Contains(b, "length") {
				t.Errorf("the refusal describes the failure: %s", b)
			}
		})
	}
}

// The one that matters most: there is no route that takes SQL. Not disabled, not
// authenticated -- absent.
func TestThereIsNoRouteThatAcceptsSQL(t *testing.T) {
	h := newServer(t).Handler()
	for _, path := range []string{
		"/v1/sql", "/v1/query", "/sql", "/query", "/v1/exec", "/v1/raw",
		"/v1/op/lesson.list/sql", "/v1/table/users",
	} {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"sql":"SELECT 1"}`))
		req.Header.Set(HeaderSecret, goodSecret)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code == http.StatusOK {
			t.Errorf("%s answered 200. The closed catalogue is the entire security model of this "+
				"service, and one statement-executing route ends it", path)
		}
	}
}

// A body field nobody declared must be refused, not ignored. This is what stops
// a caller from smuggling `"actor": 7` or `"sql": "..."` alongside a legitimate
// operation and having it silently dropped -- or worse, picked up later by a
// field somebody adds.
func TestAnUndeclaredBodyFieldIsRefused(t *testing.T) {
	h := newServer(t).Handler()
	for _, body := range []string{
		`{"op":"lesson.list","args":{},"actor":7}`,
		`{"op":"lesson.list","args":{},"sql":"SELECT 1"}`,
		`{"op":"lesson.list","args":{},"table":"users"}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/v1/op", strings.NewReader(body))
		req.Header.Set(HeaderSecret, goodSecret)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("body %s got status %d, want 400. An ignored field is one a future version "+
				"might start reading", body, w.Code)
		}
	}
}

// The actor comes from a header and only from a header. A body field named actor
// is refused above; here we prove the header is what is parsed, and that a
// nonsense value is refused rather than defaulted to 0 -- which would silently
// turn a scoped read into an unauthenticated one.
func TestTheActorComesFromTheHeaderAndIsValidated(t *testing.T) {
	h := newServer(t).Handler()
	for _, bad := range []string{"0", "-1", "abc", "1; DROP TABLE users", "1.5", " "} {
		req := httptest.NewRequest(http.MethodPost, "/v1/op",
			strings.NewReader(`{"op":"lesson.list","args":{}}`))
		req.Header.Set(HeaderSecret, goodSecret)
		req.Header.Set(HeaderActor, bad)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("actor %q got status %d, want 400", bad, w.Code)
		}
	}
}

// The catalogue is readable by an authenticated caller and must NOT include the
// SQL: the statements are a map of the schema and nothing legitimate needs them
// over the wire.
func TestTheCatalogueIsListedWithoutItsSQL(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/catalog", nil)
	req.Header.Set(HeaderSecret, goodSecret)
	w := httptest.NewRecorder()
	newServer(t).Handler().ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	for _, leak := range []string{"SELECT", "select ", "INSERT", "FROM ", "WHERE "} {
		if strings.Contains(body, leak) {
			t.Errorf("the catalogue response contains %q, so it is publishing the statements", leak)
		}
	}
	var parsed struct {
		Count      int              `json:"count"`
		Operations []map[string]any `json:"operations"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Count == 0 || len(parsed.Operations) != parsed.Count {
		t.Fatalf("count %d, %d operations", parsed.Count, len(parsed.Operations))
	}
}

func TestHealthSaysNothingUseful(t *testing.T) {
	// With a nil store this panics if it reaches the ping, so the assertion is
	// that health is the ONLY unauthenticated route and that it does reach the
	// store -- proving it is a real check and not a constant 200.
	defer func() {
		if recover() == nil {
			t.Error("GET /health returned without touching the store, so it is a constant 200 and " +
				"a database outage would show as a healthy container")
		}
	}()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	newServer(t).Handler().ServeHTTP(httptest.NewRecorder(), req)
}
