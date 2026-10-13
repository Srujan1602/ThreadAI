/* ThreadAI — /api/admin routes (admin role required for everything) */
const express = require("express");
const { requireAdmin } = require("../middleware/adminMiddleware");
const controller = require("../controllers/adminController");

const router = express.Router();

router.use(requireAdmin);

router.get("/stats", controller.stats);
router.get("/requests", controller.listRequests);
router.get("/requests/:id", controller.getRequest);
router.patch("/requests/:id/status", controller.updateStatus);
router.get("/users", controller.listUsers);
router.get("/feedback", controller.listFeedback);

module.exports = router;
