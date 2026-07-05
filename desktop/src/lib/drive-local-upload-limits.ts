export const DRIVE_LOCAL_UPLOAD_MAX_FILES = 1_000
export const DRIVE_LOCAL_UPLOAD_MAX_DIRECTORIES = 1_000
export const DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH = 12

export function createDriveLocalUploadTooManyFilesError(): Error {
  return new Error(`一次最多上传 ${DRIVE_LOCAL_UPLOAD_MAX_FILES} 个文件，请拆分后再上传。`)
}

export function createDriveLocalUploadTooManyDirectoriesError(): Error {
  return new Error(`一次最多上传 ${DRIVE_LOCAL_UPLOAD_MAX_DIRECTORIES} 个文件夹，请拆分后再上传。`)
}

export function createDriveLocalUploadTooDeepError(): Error {
  return new Error(`文件夹层级最多 ${DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH} 层，请调整后再上传。`)
}
