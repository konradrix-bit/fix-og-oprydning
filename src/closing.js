const closing = new Set();

function markClosing(channelId) {
  closing.add(channelId);
  const timer = setTimeout(() => closing.delete(channelId), 15000);
  timer.unref?.();
}

function isClosing(channelId) {
  return closing.has(channelId);
}

module.exports = { markClosing, isClosing };
