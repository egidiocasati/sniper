const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const fs = require('fs');

fs.mkdirSync(path.resolve(config.UPLOAD_DIR), { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.resolve(config.UPLOAD_DIR)),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: config.MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Formato file non supportato. Usa JPEG, PNG o WebP.'));
        }
    }
});

module.exports = upload;
