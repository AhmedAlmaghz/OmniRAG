let isSeeded = false;
async function ensurePostgresTables() {
  await new Promise(r => setTimeout(r, 2000));
  throw new Error("Late DB error");
}

async function run() {
  let timeoutId;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timeout')), 1000);
    });
    
    const dbPromise = ensurePostgresTables().catch(err => {
      if (!isSeeded) throw err; // pass to Promise.race
      console.log('Caught late DB error:', err.message);
    });

    await Promise.race([dbPromise, timeoutPromise]);
    isSeeded = true;
    console.log("Success");
  } catch (err) {
    isSeeded = true; // fallback
    console.log("Caught:", err.message);
  } finally {
    clearTimeout(timeoutId);
  }
}

run();
setTimeout(() => console.log('Process alive after 3s'), 3000);
