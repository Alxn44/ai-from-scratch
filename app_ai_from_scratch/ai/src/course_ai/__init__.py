"""The AI of the «IA desde cero» course.

EVERYTHING that is AI lives here: the ontology, the graph that verifies it, the
prompt and the agent loop. TypeScript keeps the HTTP backend and the frontend.

The boundary is deliberate: this service does NOT talk to Postgres. The tools are
executed by the Node API, which is the only side holding the session's userId. If
this service could query the database, isolation between users would be
implemented twice in two languages — and the day they diverge, the wrong copy
wins.
"""

VERSION = "3.0.0"
