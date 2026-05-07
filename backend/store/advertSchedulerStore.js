export function startCoreClashAdvertScheduler() {
  let state = readAdvertState();

  const now = Date.now();

  // 🔥 FIRST EVER RUN (no state exists yet)
  if (!state.nextSendAt && !state.lastSentAt) {
    console.log("[TG AD] First startup → sending advert immediately");

    // fire immediately (no await to avoid blocking boot)
    sendTelegramCoreClashAdvert().catch((err) =>
      console.error("[TG AD] Initial send failed:", err.message || err)
    );

    // schedule next properly
    const nextSendAt = computeNextAdvertSendAt(new Date());

    writeAdvertState({
      nextIndex: 1 % ADVERT_MESSAGES.length,
      lastSentAt: new Date().toISOString(),
      nextSendAt,
    });

    state = readAdvertState();
  }

  // 🧠 If somehow nextSendAt is missing (edge case)
  if (!state.nextSendAt) {
    const nextSendAt = computeNextAdvertSendAt(new Date());

    writeAdvertState({
      ...state,
      nextSendAt,
    });

    state = readAdvertState();
  }

  const scheduleNext = () => {
    const freshState = readAdvertState();
    const targetTime = new Date(freshState.nextSendAt).getTime();
    const delay = Math.max(0, targetTime - Date.now());

    console.log(`[TG AD] Next advert scheduled for ${freshState.nextSendAt}`);

    setTimeout(async () => {
      try {
        await sendTelegramCoreClashAdvert();
      } catch (err) {
        console.error("[TG AD] Failed:", err.message || err);
      }

      scheduleNext();
    }, delay);
  };

  scheduleNext();
}