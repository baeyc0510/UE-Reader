// Chat attachments: the client uploads a picked file's bytes; the response is its text summary.
import express from 'express';
import { asyncRoute } from '../http/security.mjs';
import { fail } from '../source/source.mjs';
import { MAX_ATTACHMENT_BYTES } from '../analysis/attachments.mjs';

export function attachmentRoutes(app, { attachments }) {
  const parse = express.raw({ type: 'application/octet-stream', limit: MAX_ATTACHMENT_BYTES });
  const raw = (req, res, next) => parse(req, res, e => next(e?.type === 'entity.too.large' ? fail('40MB 이하의 파일만 첨부할 수 있습니다.', 413) : e));
  app.post('/api/attachments', raw, asyncRoute(async (req, res) => {
    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { /* Keep the default name. */ }
    res.json(await attachments.add(name, Buffer.isBuffer(req.body) ? req.body : null));
  }));
}
