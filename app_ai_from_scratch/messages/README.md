# Messages

Document store for every AI chat turn. It is not the course database.

Postgres is used as a JSONB document store: one table, no foreign keys, no
person lookup. The course API injects `userId` after reading the session
cookie. This process never sees a cookie and never accepts a person identifier
from the browser.

- TypeScript 7 with `tsgo`.
- Own Postgres (`messages-db`, port 5436 locally).
- Service secret (`MESSAGES_SECRET`) on every route except `/health`.
- A missing `userId` in a document is rejected at insert: an un-scoped row
  cannot be returned safely, which is how other people's chats leak.

The course API calls it with `Authorization: Bearer $MESSAGES_SECRET`.
