export default class Entity {
  constructor(baseURL = 'http://localhost:3000') {
    this.baseURL = baseURL;
  }

  list() {
    throw new Error('Method "list" must be implemented');
  }

  get() {
    throw new Error('Method "get" must be implemented');
  }

  create() {
    throw new Error('Method "create" must be implemented');
  }

  update() {
    throw new Error('Method "update" must be implemented');
  }

  delete() {
    throw new Error('Method "delete" must be implemented');
  }
}