import { Conductor, AgentApp, enableAndGetAgentApp } from '@holochain/tryorama'
import {
	AppBundle,
	AppRoleManifest,
	AppRoleDnaManifest,
} from '@holochain/client'
import { TEST_DNA_PATH, JC_DNA_PATH } from './const.js'
import { Dictionary } from 'lodash'
import { Codec } from '@holo-host/cryptolib'
import * as msgpack from '@msgpack/msgpack'
import { gzipSync } from 'zlib'
import { readFileSync } from 'fs'

export const getTimestamp = () => Date.now() * 1000

type InstallAgentsOnConductorArgs = {
	conductor: Conductor
	number_of_agents: number
	membraneProofGenerator?: AgentApp
	signalHandler?: any
	holo_agent_override?: Uint8Array
	memProofMutator?: (memproof: Memproof) => Memproof
	not_editable_profile?: boolean
}

export type Memproof = {
	signed_action: {
		action: any
		signature: Buffer
	}
	entry: any
}

export const installMemProofHapp = async (c: Conductor) => {
	// Create a HAPP bundle with the DNA file included in resources
	const dnaBytes = readFileSync(JC_DNA_PATH.path)
	
	const bundle: AppBundle = {
		manifest: {
			manifest_version: '1',
			name: 'joining-code-factory',
			roles: [{
				name: 'jcf',
				dna: {
					bundled: './joining-code-factory.dna'
				}
			}],
			membrane_proofs_deferred: false,
		},
		resources: {
			'./joining-code-factory.dna': dnaBytes
		}
	}
	
	// Serialize with msgpack then compress with gzip
	const msgpackBytes = msgpack.encode(bundle)
	const bundleBytes = gzipSync(msgpackBytes)
	let appInfo = await c.installApp({
		appBundleSource: {
			type: "bytes" as const,
			value: bundleBytes
		}
	})
	const adminWs = c.adminWs()
	const port = await c.attachAppInterface()
	const issued = await adminWs.issueAppAuthenticationToken({
		installed_app_id: appInfo.installed_app_id,
	});
	const appAgentWs = await c.connectAppWs(issued.token, port)
	let app = await enableAndGetAgentApp(adminWs, appAgentWs, appInfo)
	return app
}


export const installAgentsOnConductor = async ({
	conductor,
	number_of_agents,
	membraneProofGenerator = undefined,
	memProofMutator = (m) => m,
	not_editable_profile = false,
	holo_agent_override = undefined,
}: InstallAgentsOnConductorArgs): Promise<AgentApp[]> => {
	let agentsApps: any = []

	for (let i = 0; i < number_of_agents; i++) {
		// Manually generates an agent
		const agentPubKey = await conductor.adminWs().generateAgentPubKey()

		// Generate a mem-proof for just created agent
		let membraneProof
		if (!!membraneProofGenerator) {
			console.log('Membrane proof generator agent:', Codec.AgentId.encode(membraneProofGenerator.agentPubKey))
			console.log('New agent pubkey:', Codec.AgentId.encode(agentPubKey))
			console.log('Holo agent override:', holo_agent_override ? Codec.AgentId.encode(holo_agent_override) : 'none')
			
			const membrane_proof: Memproof = await membraneProofGenerator.cells[0].callZome({
				zome_name: 'code-generator',
				fn_name: 'make_proof',
				payload: {
					role: 'holofuel',
					record_locator: 'RECORD_LOCATOR',
					registered_agent: Codec.AgentId.encode(agentPubKey),
				},
			})
			const mutated = memProofMutator(membrane_proof)
			membraneProof = Array.from(msgpack.encode(mutated))
		}

		agentsApps.push({
			appBundleSource: { 
				type: "path" as const,
				value: TEST_DNA_PATH.path.replace('.dna', '.happ')
			},
			options: {
				agentPubKey,
				membraneProofs: membraneProof
					? { "profile": membraneProof }
					: undefined,
				rolesSettings: {
					"profile": {
						type: "provisioned" as const,
						value: {
							membrane_proof: membraneProof,
							modifiers: {
								properties: {
									not_editable_profile,
									skip_proof: !membraneProofGenerator,
									holo_agent_override: holo_agent_override
										? Codec.AgentId.encode(holo_agent_override)
										: membraneProofGenerator
										? Codec.AgentId.encode(membraneProofGenerator?.agentPubKey)
										: undefined,
								},
							},
						},
					},
				},
			}
		})
	}
	try {
		let apps = await conductor.installAgentsApps({
		agentsApps,
		// networkSeed?: string;
		// installedAppId?: string;
	})
	await conductor.attachAppInterface()
	const adminWs = conductor.adminWs()
	const port = await conductor.attachAppInterface()
	let appInstance = []
	for (const agentApps of apps) {
		const issued1 = await adminWs.issueAppAuthenticationToken({
			installed_app_id: agentApps.installed_app_id,
		  });
		  const appAgentWs = await conductor.connectAppWs(issued1.token, port)		
		let app = await enableAndGetAgentApp(adminWs, appAgentWs, agentApps)
		appInstance.push({
			conductor,
			appAgentWs,
			...app,
		})
	}
	return appInstance	
} catch (e) {
		console.log('Error installing happ: ', e)
		throw e
	}
}

const createHappBundle = (
	name,
	dnas: Dictionary<string, AppRoleDnaManifest>
) => {
	const bundle: AppBundle = {
		manifest: {
			manifest_version: '1',
			name,
			roles: [],
			membrane_proofs_deferred: false,
		},
		resources: {},
	}

	for (let [role_name, roleManifest] of Object.entries(dnas)) {
		let x: AppRoleManifest = {
			name: role_name,
			dna: roleManifest as AppRoleDnaManifest,
		}
		bundle.manifest.roles.push(x)
	}

	return bundle
}

