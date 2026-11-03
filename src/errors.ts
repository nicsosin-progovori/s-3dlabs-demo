export type LabErrorCode = 'logoType' | 'logoSize' | 'logoResolution' | 'logoRead' | 'logoUpload' | 'modelExternal' | 'modelCompression' | 'modelRead' | 'modelEmpty' | 'pngSave'

export class LabError extends Error {
  readonly code:LabErrorCode
  constructor(code: LabErrorCode) {
    super(code)
    this.code=code
    this.name = 'LabError'
  }
}
