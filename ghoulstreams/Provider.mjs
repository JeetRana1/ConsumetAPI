class Provider {
    constructor() {
        this.baseUrl = '';
        this.name = '';
    }

    async search(query) {
        throw new Error('search method not implemented');
    }

    async fetchInfo(id) {
        throw new Error('fetchInfo method not implemented');
    }

    async fetchSources(embedUrl) {
        throw new Error('fetchSources method not implemented');
    }
}

export { Provider };