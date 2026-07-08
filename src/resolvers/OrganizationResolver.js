import { organizationRepository } from '../repositories/organizationRepository.js'
import { BaseResolver, EntityNotFoundError } from './BaseResolver.js'

function getOrganizationField(organization, field) {
	return organization?.[field] || 'Unknown'
}

function printOldOrganizationDebug(organization) {
	console.log('OLD Organization:')
	console.log(`- id: ${getOrganizationField(organization, 'id')}`)
	console.log(`- name: ${getOrganizationField(organization, 'name')}`)
	console.log(
		`- externalCode: ${getOrganizationField(organization, 'externalCode')}`,
	)
	console.log(`- meta.href: ${organization?.meta?.href || 'Unknown'}`)
}

function printNewOrganizationDebug(organizations) {
	console.log('NEW Organizations:')
	for (const organization of organizations) {
		console.log(`- id: ${getOrganizationField(organization, 'id')}`)
		console.log(`  name: ${getOrganizationField(organization, 'name')}`)
		console.log(
			`  externalCode: ${getOrganizationField(organization, 'externalCode')}`,
		)
	}
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
				const newOrganizations = await this.repository.findAll({
					client: 'new',
				})
				printNewOrganizationDebug(newOrganizations)
			}

			throw error
		}
	}
}

export const organizationResolver = new OrganizationResolver()

export default organizationResolver
