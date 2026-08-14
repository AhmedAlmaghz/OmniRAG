process.on('unhandledRejection', (err) => {
  console.log('UNHANDLED:', err.message);
});
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('Timeout')), 1000)
);
const successPromise = new Promise(resolve => setTimeout(() => resolve('Success'), 500));

Promise.race([successPromise, timeoutPromise])
  .then(console.log)
  .catch(console.error);

setTimeout(() => console.log('Process still alive'), 2000);
