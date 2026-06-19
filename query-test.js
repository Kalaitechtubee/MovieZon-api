const NetMirrorProvider = require('./src/providers/netmirror');
const logger = require('./src/logger');

async function testProvider() {
  const provider = new NetMirrorProvider();
  
  // Make sure we enable debug logging
  logger.level = 'debug';

  try {
    console.log("Calling provider.stream()...");
    const result = await provider.stream('76479', 'tv', 1, 1, null, '127.0.0.1');
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Provider stream error caught:", err.message);
  }
}

testProvider();

check();
