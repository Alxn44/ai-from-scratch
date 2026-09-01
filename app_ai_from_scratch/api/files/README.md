# Course PDF artifacts

`curso-es.pdf` is the Spanish offline course guide served by `GET /api/pdf/es`.
The API route requires an authenticated account with active paid access.

Release checks:

- 49 pages at 960 x 540 points.
- SHA-256: `d4dd6a20f6724bd18b1008d39c492a1dba292b8d7a88799dd94b6f020a3c332b`.
- The runtime API image copies this directory to `/app/api/files`.

The English route remains intentionally unavailable until `curso-en.pdf` is
reviewed and added as a separate artifact.
