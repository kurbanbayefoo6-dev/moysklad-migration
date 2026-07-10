import { organizationRepository } from '../repositories/organizationRepository.js'
import { BaseResolver, EntityNotFoundError } from './BaseResolver.js'

function getOrganizationField(organization, field) {
	return organization?.[field] || 'Unknown'
}

function printOldOrganizationDebug(organization) {
	return organization
}

function printNewOrganizationDebug(organizations) {
	return organizations
}

export class OrganizationResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Organization',
			repository: options.repository || organizationRepository,
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

	async resolve(source, options = {}) {
		try {
			return await super.resolve(source, options)
		} catch (error) {
			if (error instanceof EntityNotFoundError) {
				printOldOrganizationDebug(source)
				const newOrganizations = await this.getEntities({
					...options,
					client: options.client || this.client,
				})
				printNewOrganizationDebug(newOrganizations)
			}

			throw error
		}
	}
}

export const organizationResolver = new OrganizationResolver()

export default organizationResolver
