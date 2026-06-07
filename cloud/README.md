# IPM Cloud

IPM Cloud is the v2.1 backend workspace for cloud collaboration, Skill distribution, and external source connectors.

The first milestone is **C0: backend skeleton and cloud infrastructure**:

- Fastify API server
- PostgreSQL metadata store
- Aliyun OSS client placeholder
- `/health` endpoint
- auth module placeholder
- Docker Compose for local/server deployment

## Local Development

```bash
cd cloud/server
npm install
copy env.example .env
npm run dev
```

The default API port is `4210`.

Health check:

```bash
curl http://localhost:4210/health
```

## Docker Compose

```bash
cd cloud
docker compose up --build
```

Services:

- `api`: `http://localhost:4210`
- `postgres`: local development PostgreSQL on `localhost:5432`

Docker Compose does not require a local `.env` file for C0. OSS variables can be exported in the shell or placed in a Compose-level `.env` file when needed.

For production, do not expose PostgreSQL to the public internet. Keep only `80/443` open for the reverse proxy and keep database access private.

## OSS Credentials

OSS credentials must stay on the server side.

Desktop clients should never receive `OSS_ACCESS_KEY_SECRET`. Later phases should use signed URLs or STS credentials for direct upload/download.

Required env vars:

```text
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=your-ipm-cloud-bucket
OSS_ACCESS_KEY_ID=your-access-key-id
OSS_ACCESS_KEY_SECRET=your-access-key-secret
```

## C0 Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | service identity |
| GET | `/health` | database and OSS readiness check |
| GET | `/auth/status` | auth placeholder |

## Next Phases

- C1: Org / Workspace / Blob / Manifest schema
- C2: Desktop cloud binding and local scanner
- C3: publish local workspace to cloud
