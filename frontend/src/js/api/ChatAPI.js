import Entity from './Entity';
import createRequest from './createRequest';

export default class ChatAPI extends Entity {
  async create(userData) {
    return createRequest({
      url: `${this.baseURL}/new-user`,
      method: 'POST',
      data: userData,
    });
  }
}