const { v4: uuidv4 } = require('uuid');

const JITSI_SERVER = 'https://meet.jit.si';

/**
 * Generates a unique Jitsi meeting URL.
 * @returns {string} The full Jitsi meeting URL.
 */
function generateMeetingUrl() {
  const roomName = `SehhaPro-Telemedicine-${uuidv4()}`;
  return `${JITSI_SERVER}/${roomName}`;
}

module.exports = {
  generateMeetingUrl,
}; 