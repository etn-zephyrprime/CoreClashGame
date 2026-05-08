export function startZephyrosAdvertScheduler() {
  let state = readAdvertState();
  const todayKey = getDateKey(new Date());

  if (!state.firstStartupSent) {
    console.log("[TG AD] First startup → sending first advert immediately");

    sendZephyrosAdvertByIndex(0)
      .then(() => {
        const fresh = readAdvertState();
        writeAdvertState({
          ...fresh,
          firstStartupSent: true,
          lastSentAt: new Date().toISOString(),
        });
      })
      .catch((err) =>
        console.error("[TG AD] Initial send failed:", err.message || err)
      );
  }

  if (!state.scheduleDate || state.scheduleDate !== todayKey) {
    state = {
      ...state,
      scheduleDate: todayKey,
      dailyQueue: buildDailyAdvertQueue(new Date()),
    };

    writeAdvertState(state);
  }

  const tick = async () => {
    const fresh = readAdvertState();
    const currentDateKey = getDateKey(new Date());

    if (fresh.scheduleDate !== currentDateKey) {
      writeAdvertState({
        ...fresh,
        scheduleDate: currentDateKey,
        dailyQueue: buildDailyAdvertQueue(new Date()),
      });
      return;
    }

    const queue = Array.isArray(fresh.dailyQueue) ? fresh.dailyQueue : [];
    const now = Date.now();
    let dirty = false;

    for (const item of queue) {
      if (!item.sent && new Date(item.sendAt).getTime() <= now) {
        await sendZephyrosAdvertByIndex(item.index);
        item.sent = true;
        dirty = true;
      }
    }

    if (dirty) {
      writeAdvertState({
        ...fresh,
        dailyQueue: queue,
        lastSentAt: new Date().toISOString(),
      });
    }
  };

  setInterval(() => {
    tick().catch((err) =>
      console.error("[TG AD] Daily scheduler failed:", err.message || err)
    );
  }, 60 * 1000);

  tick().catch((err) =>
    console.error("[TG AD] Initial scheduler tick failed:", err.message || err)
  );
}