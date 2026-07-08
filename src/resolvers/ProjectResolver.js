import { projectRepository } from '../repositories/projectRepository.js'
import { BaseResolver } from './BaseResolver.js'

export class ProjectResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Project',
			repository: options.repository || projectRepository,
			client: options.client || 'new',
			strategies: [
				{
					name: 'externalCode',
					field: 'externalCode',
					method: 'findByExternalCode',
				},
				{ name: 'name', field: 'name', method: 'findByName' },
			],
		})
	}
}

export const projectResolver = new ProjectResolver()

export default projectResolver
