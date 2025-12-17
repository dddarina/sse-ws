export default class Entity {
  constructor(baseURL = 'https://sse-nq1x22rx8-dddarinas-projects.vercel.app') {
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