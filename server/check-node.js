// OpenParlor stores its data with Node's built-in SQLite module, which needs Node 22.13 or newer.
// Checked first, so an old Node prints a clear message instead of a stack trace.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nOpenParlor needs Node 22.13 or newer. You are running Node ${process.versions.node}.`);
  console.error('Install a newer Node from https://nodejs.org (or run "nvm install 22"), then try again.\n');
  process.exit(1);
}
