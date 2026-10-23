// Client upload on, as production must run it (links point at an https web
// app). Import this BEFORE create-test-app: the config is validated when the
// AppModule is imported, so setting the env later in the spec is too late.
process.env.CLIENT_UPLOAD_ENABLED = 'true';
process.env.WEB_PUBLIC_URL = 'https://portal.example.test';
