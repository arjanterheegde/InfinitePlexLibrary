import fs from "fs";
import path from "path";

export async function cleanUpDummyFile(directory: string): Promise<void> {
    try {
        // Read files in the directory
        const files = await fs.promises.readdir(directory);

        // Check if there are other files than dummy.mp4
        const hasOtherFiles = files.some((file) => file !== "dummy.mp4");

        if (hasOtherFiles) {
            const dummyPath = path.join(directory, "dummy.mp4");

            try {
                await fs.promises.access(dummyPath, fs.constants.F_OK);
                console.log("✅ Dummy file is accessible!");
            } catch {
                console.log("❌ Dummy file is not accessible!");
            }

            // Check if dummy.mp4 exists before attempting to delete
            console.log(`🗂️ Current Working Directory: ${process.cwd()}`);

            console.log(`🔍 Checking path: ${dummyPath}`);
            console.log(files);

            if (fs.existsSync(dummyPath)) {
                console.log(`🔍 Other file found in ${directory}. Removing dummy.mp4...`);
                await fs.promises.unlink(dummyPath);
                console.log("✅ dummy.mp4 successfully removed.");
            } else {
                console.log("ℹ️ dummy.mp4 does not exist, no action needed.");
            }
        } else {
            console.log(`❌ No other files found in ${directory}. dummy.mp4 will remain.`);
        }
    } catch (error) {
        console.error("❌ Error cleaning up dummy.mp4:", error);
    }
}


export async function removeDummyFolder(directory: string): Promise<void> {
    try {
        // Check if the directory exists
        await fs.promises.access(directory); // Checks if the path is accessible

        // Remove the directory and its contents
        console.log(`🗂️ Dummy folder found: ${directory}. Removing...`);
        await fs.promises.rm(directory, { recursive: true, force: true }); // Removes the directory and its contents
        console.log("✅ Dummy folder and contents successfully removed.");
    } catch (error: any) {
        if (error.code === "ENOENT") {
            console.log("ℹ️ Dummy folder does not exist, no action needed.");
        } else {
            console.error("❌ Error removing dummy folder:", error);
        }
    }
}

export async function createDummyFile(source: string, target: string): Promise<void> {

    try {
        // Check if the symlink already exists
        if (!fs.existsSync(target)) {
            console.log(`🔗 Creating dummy file: ${target} -> ${source}`);

            await fs.promises.copyFile(source, target);

            console.log("✅ Dummy file successfully created.");
        } else {
            console.log("ℹ️ Dummy file already exists.");
        }
    } catch (error) {
        console.error("❌ Error creating the dummy link:", error);
        throw error;
    }
}

export async function createSymlink(source: string, target: string): Promise<void> {
    try {
        // Check if the symlink already exists
        if (!fs.existsSync(target)) {
            console.log(`🔗 Creating symlink: ${target} -> ${source}`);

            if (process.platform === "win32") {
                // Use hard links for files on Windows TEST
                    await fs.promises.link(source, target);
            
            } else {
                // Use symlink for both files and directories on non-Windows platforms
                await fs.promises.symlink(source, target);
            }

            console.log("✅ Symlink successfully created.");
        } else {
            console.log("ℹ️ Symlink already exists.");
        }
    } catch (error) {
        console.error("❌ Error creating the symlink:", error);
        throw error;
    }
}

export async function ensureDirectoryExists(directory: string): Promise<void> {
    try {
        if (!fs.existsSync(directory)) {
            console.log(`📁 Directory not found. Creating: ${directory}`);
            await fs.promises.mkdir(directory, { recursive: true, mode: 0o777 });

            console.log("✅ Directory successfully created.");
        } else {
            console.log("ℹ️ Directory already exists.");
        }
    } catch (error) {
        console.error("❌ Error checking/creating the directory:", error);
        throw error;
    }
}