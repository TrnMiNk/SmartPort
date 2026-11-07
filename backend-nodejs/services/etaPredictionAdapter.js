// UC-016 integration seam. No AI provider is implemented or silently simulated.
const unavailablePrediction = { predictedEta: null, aiStatus: 'UNAVAILABLE' };
const etaPredictionAdapter = { async predict() { return { ...unavailablePrediction }; } };

async function predictSafely(adapter, input, now, timeoutMs = 1500) {
    const controller = new AbortController();
    let timer;
    try {
        const prediction = await Promise.race([
            Promise.resolve().then(() => adapter.predict(input, { signal: controller.signal })),
            new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('ETA timeout')); }, timeoutMs); })
        ]);
        // AVAILABLE must come from an explicitly successful provider, never declared ETA fallback.
        if (prediction?.aiStatus === 'AVAILABLE' && prediction.predictedEta != null &&
            Number.isFinite(new Date(prediction.predictedEta).getTime()) && new Date(prediction.predictedEta) >= now) {
            return { predictedEta: new Date(prediction.predictedEta), aiStatus: 'AVAILABLE' };
        }
    } catch (_) { /* Provider errors/timeouts fall back to declared ETA, outside SQL transactions. */ }
    finally { clearTimeout(timer); }
    return { ...unavailablePrediction };
}

module.exports = { etaPredictionAdapter, predictSafely, unavailablePrediction };
