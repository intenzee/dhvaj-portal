// Vercel serverless function: every request is rewritten here (see vercel.json)
// and served by the compiled Nest app. `dist/` is produced by the build step.
module.exports = require('../dist/serverless').default;
