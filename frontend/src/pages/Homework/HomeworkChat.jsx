import { Component, createRef } from 'react'
import Banner from '../../components/Banner.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { fetchHomeworkMessages, sendHomeworkMessage } from '../../api/client.js'
import { MAX_MESSAGE_LENGTH, formatMoment } from '../../utils/homework.js'

// La app no tiene websockets: la conversación se actualiza preguntando seguido
// mientras está abierta.
const POLL_MS = 5000

/**
 * El chat entre el alumno y el docente sobre una entrega. Los mensajes propios
 * van a la derecha; `viewRole` dice cuáles son. Enter envía y Shift+Enter
 * corta la línea, como en cualquier chat.
 */
class HomeworkChat extends Component {
  state = { messages: [], loading: true, error: null, draft: '', sending: false }

  listRef = createRef()

  token = 0

  timer = null

  componentDidMount() {
    this.load()
    this.timer = setInterval(this.poll, this.props.pollMs)
  }

  componentDidUpdate(_prevProps, prevState) {
    if (prevState.messages.length !== this.state.messages.length) {
      const list = this.listRef.current
      if (list) list.scrollTop = list.scrollHeight
    }
  }

  componentWillUnmount() {
    clearInterval(this.timer)
    this.token += 1
  }

  /** Con la pestaña escondida no se pregunta: nadie lo está leyendo. */
  poll = () => {
    if (!document.hidden && !this.state.sending) this.load()
  }

  load() {
    const token = ++this.token
    fetchHomeworkMessages(this.props.submissionId)
      .then((messages) => {
        if (token !== this.token) return
        this.setState({ messages, loading: false, error: null })
      })
      .catch((error) => {
        if (token !== this.token) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar los mensajes.',
        })
      })
  }

  handleDraftChange = (event) => this.setState({ draft: event.target.value })

  handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      this.handleSend()
    }
  }

  handleSubmit = (event) => {
    event.preventDefault()
    this.handleSend()
  }

  handleSend() {
    const body = this.state.draft.trim()
    if (!body || this.state.sending) return
    // Una lectura en camino pudo salir antes de este mensaje: se descarta,
    // para que no lo haga desaparecer al llegar.
    this.token += 1
    this.setState({ sending: true, error: null })
    sendHomeworkMessage(this.props.submissionId, body)
      .then((message) => {
        this.setState((prev) => ({
          messages: [...prev.messages, message],
          draft: '',
          sending: false,
        }))
      })
      .catch((error) => {
        this.setState({
          sending: false,
          error: error.message || 'No se pudo enviar el mensaje.',
        })
      })
  }

  renderMessage(message) {
    const mio = message.senderRole === this.props.viewRole
    return (
      <li key={message.id} className={`homework-message ${mio ? 'is-mine' : ''}`}>
        {mio ? null : <span className="homework-message-author">{message.senderName}</span>}
        <p className="homework-message-body">{message.body}</p>
        <time className="homework-message-time" dateTime={message.createdAt}>
          {formatMoment(message.createdAt)}
        </time>
      </li>
    )
  }

  renderMessages() {
    const { messages, loading } = this.state
    if (loading) {
      return (
        <p className="homework-empty">
          <SpinnerIcon className="spin" />
          Cargando mensajes...
        </p>
      )
    }
    if (messages.length === 0) {
      return <p className="homework-empty">Todavía no hay mensajes sobre esta entrega.</p>
    }
    return (
      <ul className="homework-messages" ref={this.listRef} aria-live="polite">
        {messages.map((message) => this.renderMessage(message))}
      </ul>
    )
  }

  render() {
    const { draft, sending, error } = this.state
    return (
      <section className="homework-section">
        <h3 className="homework-section-title">Mensajes</h3>
        {error ? <Banner type="danger">{error}</Banner> : null}
        {this.renderMessages()}
        <form className="homework-chat-form" onSubmit={this.handleSubmit}>
          <textarea
            className="homework-input homework-chat-input"
            rows={1}
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Escribí un mensaje..."
            aria-label="Escribí un mensaje"
            onChange={this.handleDraftChange}
            onKeyDown={this.handleKeyDown}
          />
          <button
            type="submit"
            className="class-action is-primary"
            disabled={sending || draft.trim() === ''}
          >
            {sending ? <SpinnerIcon className="spin" /> : null}
            Enviar
          </button>
        </form>
      </section>
    )
  }
}

HomeworkChat.defaultProps = {
  viewRole: 'student',
  // Inyectable para los tests.
  pollMs: POLL_MS,
}

export default HomeworkChat
