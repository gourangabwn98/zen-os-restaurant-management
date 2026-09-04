// controllers/categoryController.js
export const getCategories = async (req, res) => {
  try {
    const { Category } = req.models;
    const cats = await Category.find().sort({ name: 1 });
    res.json(cats);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// export const createCategory = async (req, res) => {
//   try {
//     const { Category } = req.models;
//     const cat = await Category.create(req.body);
//     res.status(201).json(cat);
//   } catch (err) { res.status(400).json({ message: err.message }); }
// };
// export const createCategory = async (req, res) => {
//   try {
//     const { Category } = req.models;

//     // Accept "name" OR "categoryName" from frontend
//     const name = req.body.name || req.body.categoryName || req.body.category;
//     if (!name) return res.status(400).json({ message: "Category name is required" });

//     const cat = await Category.create({
//       name,
//       image: req.body.image || req.body.categoryImage || "",
//     });
//     res.status(201).json(cat);
//   } catch (err) { res.status(400).json({ message: err.message }); }
// };

export const createCategory = async (req, res) => {
  try {
    const { Category } = req.models;

    // Works for both FormData (multer) and plain JSON
    const name = req.body.name || req.body.categoryName || req.body.category;
    if (!name?.trim())
      return res.status(400).json({ message: "Category name is required" });

    // Image from Cloudinary upload (if file sent) or plain URL
    let image = req.body.image || req.body.categoryImage || "";
    if (req.file) {
      const cloudinary  = (await import("../config/cloudinary.js")).default;
      const streamifier = (await import("streamifier")).default;
      image = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "adda-categories" },
          (err, result) => err ? reject(err) : resolve(result.secure_url)
        );
        streamifier.createReadStream(req.file.buffer).pipe(stream);
      });
    }

    const cat = await Category.create({ name: name.trim(), image });
    res.status(201).json(cat);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
export const updateCategory = async (req, res) => {
  try {
    const { Category } = req.models;
    const cat = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!cat) return res.status(404).json({ message: "Category not found" });
    res.json(cat);
  } catch (err) { res.status(400).json({ message: err.message }); }
};

export const deleteCategory = async (req, res) => {
  try {
    const { Category } = req.models;
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};
