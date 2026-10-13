/* ThreadAI — /api/requests routes (authenticated users, own data only) */
const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const controller = require("../controllers/requestController");

const router = express.Router();

router.use(requireAuth);

router.post("/", controller.createRequest);
router.get("/summary", controller.summary); // must precede /:id
router.get("/", controller.listRequests);
router.get("/:id", controller.getRequest);
router.patch("/:id/cancel", controller.cancelRequest);

module.exports = router;
