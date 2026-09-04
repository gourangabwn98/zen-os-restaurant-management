// controllers/chefController.js
export const getChefs = async (req, res) => {
  try {
    const { Chef } = req.models;
    const chefs = await Chef.find().sort({ createdAt: -1 });
    res.json({ chefs });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const createChef = async (req, res) => {
  try {
    const { Chef } = req.models;
    const chef = await Chef.create({ ...req.body, createdBy: req.user?._id });
    res.status(201).json(chef);
  } catch (err) { res.status(400).json({ message: err.message }); }
};

export const updateChef = async (req, res) => {
  try {
    const { Chef } = req.models;
    const chef = await Chef.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!chef) return res.status(404).json({ message: "Chef not found" });
    res.json(chef);
  } catch (err) { res.status(400).json({ message: err.message }); }
};

export const deleteChef = async (req, res) => {
  try {
    const { Chef } = req.models;
    await Chef.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const updateChefStatus = async (req, res) => {
  try {
    const { Chef } = req.models;
    const chef = await Chef.findByIdAndUpdate(
      req.params.id, { status: req.body.status }, { new: true }
    );
    if (!chef) return res.status(404).json({ message: "Chef not found" });
    res.json(chef);
  } catch (err) { res.status(400).json({ message: err.message }); }
};
