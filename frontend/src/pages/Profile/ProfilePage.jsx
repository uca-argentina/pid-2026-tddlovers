import { Component } from 'react'
import { Link } from 'react-router-dom'
import Banner from '../../components/Banner.jsx'
import FormField from '../../components/FormField.jsx'
import { PlusIcon, SpinnerIcon } from '../../components/icons.jsx'
import { isValidPhone } from '../../utils/validation.js'
import { fetchSubjects, updateProfile } from '../../api/client.js'
import './ProfilePage.css'

/**
 * Perfil del usuario. Muestra email, nombre y apellido de solo lectura (esos
 * los cambia el backend de auth, no esta pantalla) y deja editar SOLO el
 * teléfono, que además es opcional.
 *
 * Mirando como docente se administran las materias que da: se agregan y se
 * quitan de la lista fija que trae la base, y cada materia tiene su propio
 * botón que lleva a la disponibilidad DE ESA MATERIA. Como alumno no hay
 * sección de materias — el alumno no elige materias en su perfil, así que ni
 * siquiera se pide el catálogo.
 *
 * Un solo botón "Guardar cambios" (apagado hasta que algo realmente cambie)
 * manda teléfono y materias juntos en una sola llamada, y "Cancelar" vuelve
 * todo a como estaba. Se eligió así en vez de guardar campo por campo porque
 * son dos cosas chicas y una sola confirmación se entiende mejor.
 *
 * El rol sale de `viewRole` (el interruptor de la barra) y NO de `user.role`:
 * antes salía de user.role y quedaba incoherente con el calendario, que
 * siempre miró viewRole. Puede pasar que viewRole sea 'teacher' y la cuenta
 * tenga role 'student' — es esperable, el interruptor es un andamio de prueba,
 * y en ese caso se avisa con una línea abajo del nombre.
 *
 * El usuario guardado NO vive acá: esta pantalla se desmonta al navegar, así
 * que el estado se perdería. Al guardar se avisa para arriba con onUserChange
 * y App —que es el dueño de `user`— se queda con el dato.
 *
 * Como las rutas no tienen portero, se puede caer acá sin estar logueado: en
 * ese caso se muestra un cartel en vez de explotar.
 */
class ProfilePage extends Component {
  // Borrador de edición. Arranca copiando lo que vino por props: el usuario
  // real sigue siendo props.user hasta que se guarde, así que "¿cambió algo?"
  // es comparar este estado contra las props.
  state = {
    telefono: this.props.user?.telefono || '',
    subjectIds: this.props.user?.subjectIds || [],
    touched: {},
    subjects: [],
    subjectsLoading: false,
    subjectsError: null,
    saving: false,
    saveError: null,
    saved: false,
  }

  componentDidMount() {
    if (this.needsSubjects()) this.loadSubjects()
  }

  /**
   * El interruptor de rol cambia viewRole SIN desmontar esta pantalla (App.jsx
   * mantiene el mismo <Route> y solo cambia la prop), así que pasar de alumno a
   * docente tiene que disparar la carga que al montar nos ahorramos. Sin esto
   * el docente vería la lista vacía para siempre y parecería que no da ninguna
   * materia.
   */
  componentDidUpdate(prevProps) {
    if (prevProps.viewRole !== this.props.viewRole && this.needsSubjects()) {
      this.loadSubjects()
    }
  }

  /** El catálogo solo se muestra como docente: como alumno ni se pide. */
  needsSubjects() {
    return (
      Boolean(this.props.user) &&
      this.esDocente() &&
      !this.state.subjectsLoading &&
      this.state.subjects.length === 0
    )
  }

  esDocente() {
    return this.props.viewRole === 'teacher'
  }

  /** El rol que se está mirando no es el de la cuenta (culpa del andamio). */
  rolDesalineado() {
    return Boolean(this.props.user) && this.props.user.role !== this.props.viewRole
  }

  getInitials() {
    const { nombre, apellido } = this.props.user
    return `${nombre?.charAt(0) || ''}${apellido?.charAt(0) || ''}`.toUpperCase()
  }

  getTelefonoError() {
    // isValidPhone devuelve true con string vacío: el teléfono es opcional.
    if (!isValidPhone(this.state.telefono || '')) return 'Ingresá un teléfono válido.'
    return null
  }

  /** Las materias del usuario, resueltas contra el catálogo y en su orden. */
  getMisMaterias() {
    return this.state.subjects.filter((subject) => this.state.subjectIds.includes(subject.id))
  }

  /** Las que todavía no da — las candidatas a agregar. */
  getMateriasDisponibles() {
    return this.state.subjects.filter((subject) => !this.state.subjectIds.includes(subject.id))
  }

  isValid() {
    return !this.getTelefonoError()
  }

  /** Sin cambios reales el botón de guardar queda apagado. */
  hasChanges() {
    const { user } = this.props
    if (!user) return false

    if (this.state.telefono.trim() !== (user.telefono || '').trim()) return true

    // Como alumno la lista es de solo lectura, así que no puede haber cambios.
    if (!this.esDocente()) return false

    const originales = user.subjectIds || []
    const actuales = this.state.subjectIds
    if (originales.length !== actuales.length) return true
    return actuales.some((id) => !originales.includes(id))
  }

  loadSubjects = () => {
    this.setState({ subjectsLoading: true, subjectsError: null })
    fetchSubjects()
      .then((subjects) => {
        // Defensivo, igual que en RegisterPage.
        this.setState({
          subjects: Array.isArray(subjects) ? subjects : [],
          subjectsLoading: false,
        })
      })
      .catch((error) => {
        this.setState({
          subjectsLoading: false,
          subjectsError: error.message || 'No se pudieron cargar las materias.',
        })
      })
  }

  handleChange = (field) => (event) => {
    const value = event.target.value
    this.setState({ [field]: value, saved: false })
  }

  handleBlur = (field) => () => {
    this.setState((prev) => ({ touched: { ...prev.touched, [field]: true } }))
  }

  handleToggleSubject = (subjectId) => () => {
    this.setState((prev) => ({
      subjectIds: prev.subjectIds.includes(subjectId)
        ? prev.subjectIds.filter((id) => id !== subjectId)
        : [...prev.subjectIds, subjectId],
      saved: false,
    }))
  }

  handleCancel = () => {
    const { user } = this.props
    this.setState({
      telefono: user?.telefono || '',
      subjectIds: user?.subjectIds || [],
      touched: {},
      saveError: null,
      saved: false,
    })
  }

  handleSubmit = (event) => {
    event.preventDefault()

    if (!this.isValid()) {
      this.setState({ touched: { telefono: true } })
      return
    }

    const payload = {
      telefono: this.state.telefono.trim(),
      subjectIds: this.state.subjectIds,
    }

    this.setState({ saving: true, saveError: null, saved: false })
    updateProfile(payload)
      .then((user) => {
        this.setState({ saving: false, saved: true, telefono: payload.telefono })
        // El dueño de `user` es App: sin esto, salir del perfil y volver
        // mostraría de nuevo el teléfono viejo. El backend devuelve el usuario
        // ya actualizado, así que se usa ese y no lo que mandamos.
        this.props.onUserChange?.({ ...this.props.user, ...(user || payload) })
      })
      .catch((error) => {
        this.setState({
          saving: false,
          saveError: error.message || 'No se pudieron guardar los cambios.',
        })
      })
  }

  renderMateriasDocente() {
    const mias = this.getMisMaterias()
    const disponibles = this.getMateriasDisponibles()

    return (
      <>
        {mias.length === 0 ? (
          <p className="profile-meta">Todavía no elegiste materias.</p>
        ) : (
          <ul className="profile-subject-list">
            {mias.map((subject) => (
              // Los tres son hermanos, NO están anidados: un <button> no puede
              // ir adentro de otro <button>, que es justo lo que pasaría
              // reusando los chips de SubjectPicker para esto.
              <li key={subject.id} className="profile-subject-row">
                <span className="profile-subject-name">{subject.name}</span>
                {/* El texto visible es corto, pero el nombre accesible tiene
                    que decir de qué materia es: si no, hay tantos links
                    llamados "Disponibilidad" como materias (y uno más en la
                    barra), y quien use un lector de pantalla no los distingue. */}
                <Link
                  className="profile-subject-link"
                  to={`/disponibilidad/${subject.id}`}
                  aria-label={`Disponibilidad de ${subject.name}`}
                >
                  Disponibilidad
                </Link>
                <button
                  type="button"
                  className="profile-subject-remove"
                  onClick={this.handleToggleSubject(subject.id)}
                  aria-label={`Dejar de dar ${subject.name}`}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="profile-subsection-title">Agregar materia</h3>
        {disponibles.length === 0 ? (
          <p className="profile-meta">Ya estás dando todas las materias de la lista.</p>
        ) : (
          <div className="profile-subject-add">
            {disponibles.map((subject) => (
              <button
                type="button"
                key={subject.id}
                className="subject-chip"
                onClick={this.handleToggleSubject(subject.id)}
                aria-label={`Agregar ${subject.name}`}
              >
                <PlusIcon />
                {subject.name}
              </button>
            ))}
          </div>
        )}
      </>
    )
  }

  render() {
    const { user } = this.props
    const { telefono, touched, subjectsLoading, subjectsError, saving, saveError, saved } =
      this.state

    if (!user) {
      return (
        <div className="profile-page">
          <div className="profile-card profile-empty">
            <p>Iniciá sesión para ver tu perfil.</p>
            <Link className="auth-link" to="/ingresar">
              Ir al login
            </Link>
          </div>
        </div>
      )
    }

    const esDocente = this.esDocente()

    return (
      <div className="profile-page">
        <form className="profile-card" onSubmit={this.handleSubmit} noValidate>
          <div className="profile-identity">
            <span className="profile-avatar" aria-hidden="true">
              {this.getInitials()}
            </span>
            <div>
              <h1 className="profile-name">
                {user.nombre} {user.apellido}
              </h1>
              <span className="profile-role">{esDocente ? 'Docente' : 'Alumno'}</span>
              {/* El interruptor de rol es de prueba: si no coincide con la
                  cuenta, avisamos para que no parezca un error de datos. */}
              {this.rolDesalineado() ? (
                <p className="profile-role-hint">
                  Estás mirando el perfil como {esDocente ? 'docente' : 'alumno'}, pero tu cuenta
                  es de {user.role === 'teacher' ? 'docente' : 'alumno'}.
                </p>
              ) : null}
            </div>
          </div>

          {saveError ? <Banner type="danger">{saveError}</Banner> : null}
          {saved ? <Banner type="success">Listo, guardamos tus cambios.</Banner> : null}

          <div className="profile-section">
            <h2 className="profile-section-title">Datos de la cuenta</h2>
            {/* Filas de texto y no inputs deshabilitados: un input gris igual
                invita a que le hagan clic. Esto se cambia desde el backend de
                auth, no desde acá. */}
            <dl className="profile-readonly">
              <div className="profile-readonly-row">
                <dt className="profile-readonly-label">Email</dt>
                <dd className="profile-readonly-value">{user.email}</dd>
              </div>
              <div className="profile-readonly-row">
                <dt className="profile-readonly-label">Nombre</dt>
                <dd className="profile-readonly-value">{user.nombre}</dd>
              </div>
              <div className="profile-readonly-row">
                <dt className="profile-readonly-label">Apellido</dt>
                <dd className="profile-readonly-value">{user.apellido}</dd>
              </div>
            </dl>
          </div>

          <div className="profile-section">
            <h2 className="profile-section-title">Contacto</h2>
            <FormField
              label="Teléfono (opcional)"
              type="tel"
              autoComplete="tel"
              value={telefono}
              onChange={this.handleChange('telefono')}
              onBlur={this.handleBlur('telefono')}
              touched={touched.telefono}
              error={this.getTelefonoError()}
            />
          </div>

          {/* Solo el docente: el alumno no elige materias desde su perfil. */}
          {esDocente ? (
            <div className="profile-section">
              <h2 className="profile-section-title">Materias que das</h2>
              {subjectsError ? <Banner type="danger">{subjectsError}</Banner> : null}
              {subjectsLoading ? (
                <p className="subject-loading">
                  <SpinnerIcon className="spin" />
                  Cargando materias...
                </p>
              ) : (
                this.renderMateriasDocente()
              )}
            </div>
          ) : null}

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={this.handleCancel}
              disabled={!this.hasChanges() || saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!this.hasChanges() || !this.isValid() || saving}
            >
              {saving ? <SpinnerIcon className="spin" /> : null}
              Guardar cambios
            </button>
          </div>

          {/* Un <Link> y no un <button>: así navega solo y de paso no corre
              riesgo de mandar el formulario. El onClick limpia la sesión en
              App, que es quien es dueño del usuario. */}
          <div className="profile-logout">
            <Link className="profile-logout-link" to="/ingresar" onClick={this.props.onLogout}>
              Cerrar sesión
            </Link>
          </div>
        </form>
      </div>
    )
  }
}

ProfilePage.defaultProps = {
  viewRole: 'student',
}

export default ProfilePage
