const db = require('../utils/db');
const logger = require('../logger');

const historyController = {
  /**
   * GET /api/v2/history
   */
  async getHistory(req, res, next) {
    try {
      logger.info('[HistoryController] Fetching watch history');
      const items = db.getHistory();
      res.json({
        ok: true,
        success: true,
        items
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v2/history
   */
  async saveHistory(req, res, next) {
    try {
      const item = req.body;
      if (!item) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Missing watch history body payload.'
        });
      }

      logger.info(`[HistoryController] Saving watch history item for tmdbId ${item.movie?.id}`);
      const saved = db.saveHistoryItem(item);
      res.json({
        ok: true,
        success: true,
        item: saved
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v2/history/:type/:id
   */
  async removeHistory(req, res, next) {
    try {
      const { id, type } = req.params;
      logger.info(`[HistoryController] Removing history item for ${type} ID ${id}`);
      db.removeHistoryItem(id, type);
      res.json({
        ok: true,
        success: true
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v2/history
   */
  async clearHistory(req, res, next) {
    try {
      logger.info('[HistoryController] Clearing all history');
      db.clearHistory();
      res.json({
        ok: true,
        success: true
      });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = historyController;
