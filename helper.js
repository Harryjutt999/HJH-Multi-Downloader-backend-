import express from "express";
import fetch from "node-fetch";

/**
 * createRouter(actorSlug)
 * actorSlug: string, e.g. "scraper-mind/tiktok-video-downloader" (or use "~" if required)
 */
function createRouter(actorSlug) {
  const router = express.Router();

  // resolve short redirect links (vm.tiktok etc.)
  async function resolveRedirect(url) {
    try {
      const r = await fetch(url, { method: "GET", redirect: "follow" });
      return r.url || url;
    } catch (e) {
      // if resolution fails, return original
      return url;
    }
  }

  // Poll actor-run until finished; returns datasetId when succeeded
  async function pollRunForDataset(runId, token, maxAttempts = 30, intervalMs = 3000) {
    const runUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(
      token
    )}`;
    for (let i = 0; i < maxAttempts; i++) {
      const r = await fetch(runUrl);
      const j = await r.json();
      if (j?.data?.status === "SUCCEEDED") {
        return j.data.defaultDatasetId || j.data.defaultDatasetId || null;
      }
      if (j?.data?.status === "FAILED") {
        throw new Error(`Actor run failed: ${JSON.stringify(j)}`);
      }
      await new Promise((r2) => setTimeout(r2, intervalMs));
    }
    throw new Error("Timeout waiting for actor run to finish");
  }

  // try run-sync-get-dataset first; if not supported, fallback to runs + poll
  async function callApify(actor, token, url) {
    const runSyncUrl = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset?token=${encodeURIComponent(
      token
    )}`;

    // try run-sync-get-dataset
    try {
      const res = await fetch(runSyncUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      // if 200 OK -> parse and return
      if (res.ok) {
        const data = await res.json();
        // data.items or data
        return data.items || data;
      }

      // if not ok, capture response body for debugging and fall through to fallback
      const bodyText = await res.text();
      console.warn("run-sync-get-dataset returned non-ok:", res.status, bodyText);
    } catch (e) {
      console.warn("run-sync-get-dataset error:", String(e));
      // fallback below
    }

    // fallback: start run and poll
    const runsUrl = `https://api.apify.com/v2/acts/${actor}/runs?token=${encodeURIComponent(
      token
    )}`;
    const runRes = await fetch(runsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!runRes.ok) {
      const text = await runRes.text();
      throw new Error(`Failed to start actor run: ${runRes.status} ${text}`);
    }
    const runJson = await runRes.json();
    const runId = runJson?.data?.id || runJson?.id;
    if (!runId) throw new Error("No run id returned by Apify when starting run");

    // poll until finished and get dataset id
    const datasetId = await pollRunForDataset(runId, token);
    if (!datasetId) throw new Error("No datasetId returned after run succeeded");

    // fetch dataset items
    const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&clean=true&token=${encodeURIComponent(
      token
    )}`;
    const dsRes = await fetch(datasetUrl);
    if (!dsRes.ok) {
      const txt = await dsRes.text();
      throw new Error(`Failed to fetch dataset: ${dsRes.status} ${txt}`);
    }
    const dsJson = await dsRes.json();
    return dsJson;
  }

  router.get("/", async (req, res) => {
    try {
      let { url } = req.query;
      if (!url) return res.status(400).json({ error: "No URL provided" });

      // resolve some short links (tiktok vm links)
      if (url.includes("vm.tiktok.com") || url.includes("vt.tiktok.com")) {
        url = await resolveRedirect(url);
      }

      const token = process.env.APIFY_TOKEN;
      if (!token) return res.status(500).json({ error: "APIFY_TOKEN not set" });

      // NOTE: actorSlug may be provided with "/" or "~"
      // Try callApify with actorSlug as-is. If that fails and actorSlug contains "/", try replacing with "~".
      let items;
      try {
        items = await callApify(actorSlug, token, url);
      } catch (err1) {
        console.warn("callApify failed with actorSlug:", actorSlug, String(err1));
        if (actorSlug.includes("/")) {
          const alt = actorSlug.replace("/", "~");
          console.warn("Retrying with actor slug:", alt);
          items = await callApify(alt, token, url);
        } else {
          throw err1;
        }
      }

      const arr = items || [];
      if (!arr || arr.length === 0) return res.status(404).json({ error: "No items returned by actor" });

      const first = arr[0];
      const video =
        first?.video ||
        first?.url ||
        first?.downloadUrl ||
        first?.videoUrl ||
        first?.src ||
        first?.play || // some actors
        null;

      return res.json({ video, raw: first });
    } catch (err) {
      console.error(`${actorSlug} handler error:`, err);
      // send readable message
      return res.status(500).json({ error: "Server error", details: String(err) });
    }
  });

  return router;
}

export default createRouter;
