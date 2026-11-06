import {
  Client,
  DiscordAPIError,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type GuildMember,
} from 'discord.js';
import { config } from './config.js';
import { log, logError } from './log.js';

// Only the Guilds intent is needed: fetching a single member by ID goes through
// REST, so the privileged GuildMembers intent is not required.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

export async function startDiscord(): Promise<void> {
  const ready = new Promise<void>((resolve) => {
    client.once(Events.ClientReady, (c) => {
      log(`[discord] logged in as ${c.user.tag}`);
      resolve();
    });
  });
  await client.login(config.discordToken);
  await ready;
  await logRoleDiagnostics();
}

// One-time startup check of everything that decides whether the bot can manage the Premium role.
async function logRoleDiagnostics(): Promise<void> {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const me = await guild.members.fetchMe();
    const premiumRole = await guild.roles.fetch(config.premiumRoleId);
    if (!premiumRole) {
      logError(`[discord] diagnostics: Premium role ${config.premiumRoleId} not found in guild ${guild.id}`);
      return;
    }
    log('[discord] diagnostics:', {
      botHighestRole: me.roles.highest.name,
      botHighestRolePosition: me.roles.highest.position,
      premiumRole: premiumRole.name,
      premiumRolePosition: premiumRole.position,
      hasManageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles),
      premiumRoleEditable: premiumRole.editable,
      premiumRoleManaged: premiumRole.managed,
      guildOwnerId: guild.ownerId,
      guildMfaLevel: guild.mfaLevel,
    });
  } catch (err) {
    logError('[discord] diagnostics failed:', err);
  }
}

async function fetchMember(userId: string): Promise<GuildMember | null> {
  const guild = await client.guilds.fetch(config.guildId);
  try {
    return await guild.members.fetch(userId);
  } catch (err) {
    if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMember) {
      return null;
    }
    throw err;
  }
}

export async function addPremiumRole(userId: string, reason: string): Promise<void> {
  const member = await fetchMember(userId);
  if (!member) {
    log(`[discord] user ${userId} is not in the guild; cannot add Premium role`);
    return;
  }
  await member.roles.add(config.premiumRoleId, reason);
  log(`[discord] added Premium role to ${member.user.tag} (${userId})`);
}

export async function removePremiumRole(userId: string, reason: string): Promise<void> {
  const member = await fetchMember(userId);
  if (!member) {
    log(`[discord] user ${userId} is not in the guild; nothing to remove`);
    return;
  }
  await member.roles.remove(config.premiumRoleId, reason);
  log(`[discord] removed Premium role from ${member.user.tag} (${userId})`);
}
