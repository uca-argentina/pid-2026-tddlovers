import { Component } from 'react'
import './BrandLogo.css'

/**
 * El logo de BookIt: una hoja de calendario con un turno marcado y la
 * insignia con el tilde de "reservado". Hay dos versiones de la misma idea:
 *
 * - BrandLogo (completa): con la hoja de atrás que le da profundidad y la
 *   grilla entera. Va en el login, donde hay lugar.
 * - BrandMark (simplificada): sin la hoja de atrás y con menos celdas, para
 *   que se siga leyendo a 30px en la barra lateral.
 *
 * Los colores salen de variables CSS (BrandLogo.css) y no de atributos fill:
 * la misma marca tiene que verse sobre el fondo claro del login y sobre lo
 * oscuro de la barra o del login en el teléfono, y eso lo decide el contenedor.
 * Ninguna de las dos lleva el nombre: el texto "BookIt" queda al lado como
 * texto de verdad. Son decorativas (aria-hidden) porque el nombre ya está.
 */
export class BrandLogo extends Component {
  render() {
    return (
      <svg className={`brand-logo ${this.props.className || ''}`} viewBox="0 0 120 120" aria-hidden="true">
        <rect className="brand-back" x="26" y="24" width="80" height="78" rx="16" transform="rotate(8 66 63)" />
        <rect className="brand-page" x="14" y="22" width="82" height="80" rx="16" />
        <path className="brand-header" d="M14 38 A16 16 0 0 1 30 22 H80 A16 16 0 0 1 96 38 V44 H14 Z" />
        <rect className="brand-ring" x="31" y="13" width="7" height="17" rx="3.5" />
        <rect className="brand-ring" x="72" y="13" width="7" height="17" rx="3.5" />
        <rect className="brand-cell" x="25" y="54" width="16" height="13" rx="4" />
        <rect className="brand-cell is-booked" x="47" y="54" width="16" height="13" rx="4" />
        <rect className="brand-cell" x="69" y="54" width="16" height="13" rx="4" />
        <rect className="brand-cell" x="25" y="73" width="16" height="13" rx="4" />
        <rect className="brand-cell" x="47" y="73" width="16" height="13" rx="4" />
        <circle className="brand-badge" cx="94" cy="92" r="19" strokeWidth="5" />
        <path className="brand-check" d="M85.5 92.5 L91.5 98.5 L102.5 86.5" strokeWidth="5" />
      </svg>
    )
  }
}

export class BrandMark extends Component {
  render() {
    return (
      <svg className={`brand-logo brand-mark ${this.props.className || ''}`} viewBox="0 0 32 32" aria-hidden="true">
        <rect className="brand-page" x="1" y="4" width="26" height="25" rx="6" />
        <path className="brand-header" d="M1 10 A6 6 0 0 1 7 4 H21 A6 6 0 0 1 27 10 V12 H1 Z" />
        <rect className="brand-ring" x="6.5" y="1" width="3" height="6.5" rx="1.5" />
        <rect className="brand-ring" x="18.5" y="1" width="3" height="6.5" rx="1.5" />
        <rect className="brand-cell" x="5" y="15.5" width="5.5" height="4.5" rx="1.4" />
        <rect className="brand-cell is-booked" x="12.5" y="15.5" width="5.5" height="4.5" rx="1.4" />
        <rect className="brand-cell" x="5" y="22" width="5.5" height="4.5" rx="1.4" />
        <circle className="brand-badge" cx="24" cy="24" r="7" strokeWidth="2" />
        <path className="brand-check" d="M20.8 24.2 L23 26.4 L27 22.2" strokeWidth="2.2" />
      </svg>
    )
  }
}
