const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

class LocalDocumentStorage {
    constructor(directory = process.env.DOCUMENT_STORAGE_DIR ||
        path.join(os.tmpdir(), 'smartport-vessel-documents')) {
        this.directory = path.resolve(directory);
        const repositoryRoot = path.resolve(__dirname, '..');
        const relativePath = path.relative(repositoryRoot, this.directory);
        if (relativePath === '' ||
            (!relativePath.startsWith(`..${path.sep}`) &&
             relativePath !== '..' && !path.isAbsolute(relativePath))) {
            throw new Error('DOCUMENT_STORAGE_DIR must be outside the backend repository');
        }
    }

    async put(buffer, extension) {
        if (!ALLOWED_EXTENSIONS.has(extension)) {
            throw new Error('Unsupported document extension');
        }
        await fs.mkdir(this.directory, { recursive: true });
        const key = `${randomUUID()}${extension}`;
        try {
            await fs.writeFile(path.join(this.directory, key), buffer, { flag: 'wx' });
        } catch (error) {
            await fs.rm(path.join(this.directory, key), { force: true }).catch(() => {});
            throw error;
        }
        return key;
    }

    async read(key) {
        if (typeof key !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/i.test(key)) {
            throw new Error('Invalid storage key');
        }
        return fs.readFile(path.join(this.directory, key));
    }

    async delete(key) {
        if (typeof key !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/i.test(key)) {
            return;
        }
        await fs.rm(path.join(this.directory, key), { force: true });
    }
}

module.exports = { LocalDocumentStorage };
