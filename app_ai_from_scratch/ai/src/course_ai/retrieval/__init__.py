"""Retrieval: the half of «find whatever the customer asks for» that belongs in Python.

Nothing in this package reads a table, opens a connection or decides who paid.
It cannot: there is no database driver in this service, and that absence IS the
isolation guarantee (see course_ai/__init__.py and agent/bridge.py). What lives
here is the part Node's substring scorer cannot do — turning the words a beginner
actually types into a lesson NUMBER and a better query string — and everything it
knows about a lesson beyond that number is fetched from `curso_indice` at call
time, over the bridge, by Node.

    concepts.py   the curated map: slug -> lesson number, plus the student's own
                  phrasings and the PUBLIC glossary terms. No titles, no prose.
    query.py      normalise, drop the stopwords Node's `length > 2` filter lets
                  through, expand into the course's words in both languages.
    intent.py     the questions no lesson answers — price, account, settings,
                  privacy, downloads, something is broken — mapped to the PUBLIC
                  bridged tool that holds the fact. It names the tool; it holds no
                  price, no route and no policy of its own.
    index.py      reads the real public lesson index out of Node, by subprocess.
    tools.py      the three native tools, the composition fence and the dispatch
                  the loop goes through.
    check.py      `ai-check-concepts`: the gate that fails when the map and the
                  index disagree.

TWO THINGS ARE ANSWERED HERE AND NEITHER IS CONTENT: which lesson, and which tool.
A native tool may reach the bridge only for the names it DECLARES in
`Tool.composes`, and `tools.dispatch` is what enforces that at the call itself —
for a while the allowlist was read only by the proof, the artefact and the
document, and a handler that fetched `leccion_texto` and passed the prose through
was invisible to every gate in the repository.
"""
