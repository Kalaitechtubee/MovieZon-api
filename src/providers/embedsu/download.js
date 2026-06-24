module.exports = async function download(id, type, season = 1, episode = 1, variantId = null) {
  return {
    success: false,
    downloadSupported: false,
    available: false,
    message: 'unsupported'
  };
};
