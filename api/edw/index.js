// Vercel entrypoint for the EDW service — strips the /api/edw prefix and
// hands the request to the same Express app local dev runs.
const app = require('../../edw-service/src/app');
module.exports = (req, res) => {
  req.url = req.url.replace(/^\/api\/edw/, '') || '/';
  return app(req, res);
};
