export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} with id "${id}" not found`);
    this.name = "NotFoundError";
  }
}

export class NotImplementedError extends Error {
  constructor(method: string, availableIn: string) {
    super(`${method} is not implemented yet — available in ${availableIn}`);
    this.name = "NotImplementedError";
  }
}
