import { Component, createRef } from 'react'
import Banner from './Banner.jsx'
import { DownloadIcon, FileIcon, PaperclipIcon, SpinnerIcon, TrashIcon } from './icons.jsx'
import {
  classFileUrl,
  deleteClassFile,
  fetchClassMaterial,
  saveClassSummary,
  uploadClassFiles,
} from '../api/client.js'
import { hasEnded, nowParts } from '../utils/classStates.js'
import {
  MAX_SUMMARY_LENGTH,
  canEditMaterial,
  canHaveMaterial,
  canViewMaterial,
  formatBytes,
  isPreviewable,
  uploadProblem,
} from '../utils/classMaterials.js'
import './ClassMaterial.css'

/**
 * El material de una clase ya dada: el resumen que deja el docente y los
 * archivos adjuntos (fotos, pdf, planillas, código...). Es del turno, así que
 * en una grupal todos los anotados ven lo mismo.
 *
 * El docente lo carga cuando la clase terminó; el alumno lo ve desde ese
 * momento. Antes, la sección solo avisa desde cuándo. Qué se muestra lo
 * decide utils/classMaterials.js, pero el backend vuelve a chequear todo.
 *
 * Avisa con onChange(tieneMaterial) cuando cambia, para que la tarjeta de la
 * reserva muestre (o deje de mostrar) el clip.
 */
class ClassMaterial extends Component {
  state = {
    material: null,
    loading: false,
    error: null,
    draft: '',
    saving: false,
    uploading: false,
    // El id del archivo que se está borrando, y el que espera confirmación.
    deletingId: null,
    confirmDeleteId: null,
    notice: null,
  }

  fileInput = createRef()

  token = 0

  componentDidMount() {
    if (canViewMaterial(this.props.cls, this.props.viewRole, this.now())) this.load()
  }

  componentWillUnmount() {
    this.token += 1
  }

  now() {
    return this.props.now || nowParts()
  }

  load() {
    const token = ++this.token
    this.setState({ loading: true, error: null })
    fetchClassMaterial(this.props.cls.id)
      .then((material) => {
        if (token !== this.token) return
        this.setState({ material, draft: material.summary, loading: false })
      })
      .catch((error) => {
        if (token !== this.token) return
        this.setState({ loading: false, error: error.message || 'No se pudo cargar el material.' })
      })
  }

  /** Lo que devuelve cualquier cambio es el material entero: se reemplaza. */
  applyMaterial(material, extra = {}) {
    this.setState({ material, ...extra })
    this.props.onChange(material.summary !== '' || material.files.length > 0)
  }

  handleDraftChange = (event) => {
    this.setState({ draft: event.target.value, notice: null })
  }

  handleSaveSummary = () => {
    if (this.state.saving) return
    this.setState({ saving: true, error: null, notice: null })
    saveClassSummary(this.props.cls.id, this.state.draft)
      .then((material) =>
        this.applyMaterial(material, {
          saving: false,
          draft: material.summary,
          notice: 'Resumen guardado.',
        }),
      )
      .catch((error) =>
        this.setState({ saving: false, error: error.message || 'No se pudo guardar el resumen.' }),
      )
  }

  handlePickFiles = () => this.fileInput.current?.click()

  handleFilesChosen = (event) => {
    const files = [...(event.target.files || [])]
    // Se vacía el input para que elegir el mismo archivo de nuevo vuelva a
    // disparar el change (por ejemplo, después de un error).
    event.target.value = ''
    if (files.length === 0 || this.state.uploading) return

    const problema = uploadProblem(this.state.material?.files || [], files)
    if (problema) {
      this.setState({ error: problema, notice: null })
      return
    }

    this.setState({ uploading: true, error: null, notice: null })
    uploadClassFiles(this.props.cls.id, files)
      .then((material) => {
        const cuantos =
          files.length === 1 ? 'Se subió el archivo.' : `Se subieron ${files.length} archivos.`
        this.applyMaterial(material, { uploading: false, notice: cuantos })
      })
      .catch((error) =>
        this.setState({
          uploading: false,
          error: error.message || 'No se pudieron subir los archivos.',
        }),
      )
  }

  handleAskDelete = (fileId) => () => this.setState({ confirmDeleteId: fileId })

  handleKeepFile = () => this.setState({ confirmDeleteId: null })

  handleDelete = (fileId) => () => {
    if (this.state.deletingId) return
    this.setState({ deletingId: fileId, error: null, notice: null })
    deleteClassFile(this.props.cls.id, fileId)
      .then((material) => this.applyMaterial(material, { deletingId: null, confirmDeleteId: null }))
      .catch((error) =>
        this.setState({
          deletingId: null,
          confirmDeleteId: null,
          error: error.message || 'No se pudo borrar el archivo.',
        }),
      )
  }

  renderSummary(editable) {
    const { material, draft, saving } = this.state
    if (!editable) {
      if (!material.summary) return null
      return <p className="class-material-summary">{material.summary}</p>
    }

    return (
      <div className="class-material-editor">
        <label className="class-material-label" htmlFor={`resumen-${this.props.cls.id}`}>
          Resumen de la clase
        </label>
        <textarea
          id={`resumen-${this.props.cls.id}`}
          className="class-material-textarea"
          value={draft}
          maxLength={MAX_SUMMARY_LENGTH}
          rows={5}
          placeholder="Qué vieron, qué quedó pendiente, qué tienen que practicar..."
          onChange={this.handleDraftChange}
        />
        <div className="class-material-editor-foot">
          <span className="class-material-counter">
            {draft.length} / {MAX_SUMMARY_LENGTH}
          </span>
          <button
            type="button"
            className="class-action is-primary"
            onClick={this.handleSaveSummary}
            disabled={saving || draft.trim() === material.summary}
          >
            {saving ? <SpinnerIcon className="spin" /> : null}
            Guardar resumen
          </button>
        </div>
      </div>
    )
  }

  renderFile(file, editable) {
    const { deletingId, confirmDeleteId } = this.state
    const url = classFileUrl(this.props.cls.id, file.id)
    const preview = isPreviewable(file.mimeType)

    return (
      <li key={file.id} className="class-material-file">
        {preview ? (
          <a href={url} target="_blank" rel="noreferrer" className="class-material-thumb">
            <img src={url} alt={file.name} loading="lazy" />
          </a>
        ) : (
          <span className="class-material-file-icon">
            <FileIcon />
          </span>
        )}
        <div className="class-material-file-info">
          <span className="class-material-file-name">{file.name}</span>
          <span className="class-material-file-size">{formatBytes(file.sizeBytes)}</span>
        </div>
        <div className="class-material-file-actions">
          {confirmDeleteId === file.id ? (
            <>
              <button type="button" className="class-action is-secondary" onClick={this.handleKeepFile}>
                No
              </button>
              <button
                type="button"
                className="class-action is-danger"
                onClick={this.handleDelete(file.id)}
                disabled={Boolean(deletingId)}
              >
                {deletingId === file.id ? <SpinnerIcon className="spin" /> : null}
                Sí, borrar
              </button>
            </>
          ) : (
            <>
              <a className="class-action is-secondary" href={url} download={file.name}>
                <DownloadIcon />
                Descargar
              </a>
              {editable ? (
                <button
                  type="button"
                  className="class-material-delete"
                  onClick={this.handleAskDelete(file.id)}
                  aria-label={`Borrar ${file.name}`}
                >
                  <TrashIcon />
                </button>
              ) : null}
            </>
          )}
        </div>
      </li>
    )
  }

  renderBody() {
    const { cls, viewRole } = this.props
    const { material, loading, uploading } = this.state
    const now = this.now()

    if (!canHaveMaterial(cls)) {
      return <p className="class-material-empty">Esta clase no se dio, así que no tiene material.</p>
    }
    if (!hasEnded(cls, now)) {
      return (
        <p className="class-material-empty">
          {viewRole === 'teacher'
            ? 'Vas a poder cargar el resumen y los archivos cuando termine la clase.'
            : 'Cuando termine la clase vas a ver acá el material que deje el docente.'}
        </p>
      )
    }
    if (loading || !material) {
      return loading ? (
        <p className="class-material-empty">
          <SpinnerIcon className="spin" />
          Cargando material...
        </p>
      ) : null
    }

    const editable = canEditMaterial(cls, viewRole, now)
    const vacio = !material.summary && material.files.length === 0

    return (
      <>
        {!editable && vacio ? (
          <p className="class-material-empty">El docente todavía no cargó material de esta clase.</p>
        ) : null}
        {this.renderSummary(editable)}

        {material.files.length > 0 ? (
          <ul className="class-material-files">
            {material.files.map((file) => this.renderFile(file, editable))}
          </ul>
        ) : null}

        {editable ? (
          <div className="class-material-upload">
            <input
              ref={this.fileInput}
              type="file"
              multiple
              hidden
              onChange={this.handleFilesChosen}
              aria-label="Elegir archivos"
            />
            <button
              type="button"
              className="class-action is-secondary"
              onClick={this.handlePickFiles}
              disabled={uploading}
            >
              {uploading ? <SpinnerIcon className="spin" /> : <PaperclipIcon />}
              {uploading ? 'Subiendo...' : 'Adjuntar archivos'}
            </button>
            <span className="class-material-hint">
              Fotos, PDF, Word, planillas, código... hasta 10 MB cada uno.
            </span>
          </div>
        ) : null}
      </>
    )
  }

  render() {
    const { error, notice } = this.state
    return (
      <section className="class-material" aria-labelledby={`material-${this.props.cls.id}`}>
        <h3 className="class-detail-section-title" id={`material-${this.props.cls.id}`}>
          Material de la clase
        </h3>
        {error ? <Banner type="danger">{error}</Banner> : null}
        {notice ? <Banner type="success">{notice}</Banner> : null}
        {this.renderBody()}
      </section>
    )
  }
}

ClassMaterial.defaultProps = {
  viewRole: 'student',
  // Inyectable para los tests; en la app es la hora real.
  now: null,
  onChange: () => {},
}

export default ClassMaterial
