// types — types shared across the scraper's layers.

// A resolution from the results page, as it appears in the CSV.
// Field names mirror the portal's own Spanish JSON keys (legal domain).
export interface Resolution {
  recurso: string;
  nroExpediente: string;
  pretension: string;
  tipoResolucion: string;
  fechaResolucion: string;
  sala: string;
  normaDI: string;
  sumilla: string;
  palabrasClave: string;
  uuid: string;
  urlDescarga: string;
}

// Session bootstrap result: page 1 already comes loaded in pageDom along
// with the total page count and the initial ViewState.
export interface SearchResult {
  pageDom: string;
  totalPages: number;
  viewState: string;
}

// A step failure with context: which step failed, the raw response body,
// and the reason (0_resolutions, no_zip...) for the error log.
export class StepFailure extends Error {
  constructor(
    public step: string,
    message: string,
    public body = "",
    public reason?: string,
  ) {
    super(message);
    this.name = "StepFailure";
  }
}