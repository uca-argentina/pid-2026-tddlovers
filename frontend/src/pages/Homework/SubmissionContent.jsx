import { Component } from 'react'
import { formatMoment, isSafeLink } from '../../utils/homework.js'

/** Lo que entregó el alumno, igual para los dos lados, con la marca de fuera de término. */
class SubmissionContent extends Component {
  render() {
    const { submission } = this.props
    return (
      <section className="homework-section">
        <h3 className="homework-section-title">Entrega</h3>
        <div className="homework-submitted-at">
          <span>Entregada el {formatMoment(submission.submittedAt)}</span>
          {submission.isLate ? (
            <span className="class-status is-danger">Fuera de término</span>
          ) : null}
        </div>
        {submission.text ? <p className="homework-text">{submission.text}</p> : null}
        {submission.linkUrl ? (
          isSafeLink(submission.linkUrl) ? (
            <a
              className="homework-link"
              href={submission.linkUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {submission.linkUrl}
            </a>
          ) : (
            <p className="homework-text">{submission.linkUrl}</p>
          )
        ) : null}
      </section>
    )
  }
}

export default SubmissionContent
