import * as migration_20260731_024800_initial_cms from './20260731_024800_initial_cms';
import * as migration_20260817_194818_mount_kenya_campaigns from './20260817_194818_mount_kenya_campaigns';
import * as migration_20260820_192444_round1_extras_and_memories from './20260820_192444_round1_extras_and_memories';

export const migrations = [
  {
    up: migration_20260731_024800_initial_cms.up,
    down: migration_20260731_024800_initial_cms.down,
    name: '20260731_024800_initial_cms',
  },
  {
    up: migration_20260817_194818_mount_kenya_campaigns.up,
    down: migration_20260817_194818_mount_kenya_campaigns.down,
    name: '20260817_194818_mount_kenya_campaigns',
  },
  {
    up: migration_20260820_192444_round1_extras_and_memories.up,
    down: migration_20260820_192444_round1_extras_and_memories.down,
    name: '20260820_192444_round1_extras_and_memories'
  },
];
