import { BaseRepository } from './baseRepository.js'

export class ProjectRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/project',
			...options,
		})
	}
}

export const projectRepository = new ProjectRepository()

export default projectRepository
