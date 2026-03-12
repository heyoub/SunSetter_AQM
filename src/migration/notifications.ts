/**
 * Migration Notifications
 *
 * Supports Slack webhook notifications for migration events
 */

/**
 * Slack webhook configuration
 */
export interface SlackNotificationConfig {
  /** Slack webhook URL */
  webhookUrl: string;
  /** Username to display */
  username?: string;
  /** Icon emoji */
  iconEmoji?: string;
  /** Channel to post to (overrides webhook default) */
  channel?: string;
  /** Notify on migration start */
  notifyOnStart?: boolean;
  /** Notify on migration complete */
  notifyOnComplete?: boolean;
  /** Notify on migration failure */
  notifyOnFailure?: boolean;
  /** Notify on table complete (can be noisy) */
  notifyOnTableComplete?: boolean;
}

/**
 * Slack message format
 */
interface SlackMessage {
  text?: string;
  username?: string;
  icon_emoji?: string;
  channel?: string;
  attachments?: Array<{
    color?: string;
    title?: string;
    text?: string;
    fields?: Array<{
      title: string;
      value: string;
      short?: boolean;
    }>;
    footer?: string;
    ts?: number;
  }>;
}

/**
 * Slack notification manager
 */
export class SlackNotifier {
  private config: SlackNotificationConfig;

  constructor(config: SlackNotificationConfig) {
    this.config = config;
  }

  /**
   * Send migration start notification
   */
  async notifyMigrationStart(data: {
    migrationId: string;
    totalTables: number;
    totalRows?: number;
  }): Promise<void> {
    if (!this.config.notifyOnStart) return;

    const message: SlackMessage = {
      username: this.config.username || 'ConVconV Migration',
      icon_emoji: this.config.iconEmoji || ':rocket:',
      channel: this.config.channel,
      attachments: [
        {
          color: '#36a64f',
          title: 'Migration Started',
          fields: [
            {
              title: 'Migration ID',
              value: data.migrationId,
              short: true,
            },
            {
              title: 'Tables',
              value: String(data.totalTables),
              short: true,
            },
            ...(data.totalRows
              ? [
                  {
                    title: 'Total Rows',
                    value: data.totalRows.toLocaleString(),
                    short: true,
                  },
                ]
              : []),
          ],
          footer: 'SunSetter AQM+',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    await this.sendSlackMessage(message);
  }

  /**
   * Send migration complete notification
   */
  async notifyMigrationComplete(data: {
    migrationId: string;
    duration: number;
    migratedRows: number;
    failedRows: number;
    tablesCompleted: number;
  }): Promise<void> {
    if (!this.config.notifyOnComplete) return;

    const durationMinutes = Math.floor(data.duration / 60000);
    const durationSeconds = Math.floor((data.duration % 60000) / 1000);

    const message: SlackMessage = {
      username: this.config.username || 'ConVconV Migration',
      icon_emoji: this.config.iconEmoji || ':white_check_mark:',
      channel: this.config.channel,
      attachments: [
        {
          color: data.failedRows > 0 ? '#ff9900' : '#36a64f',
          title: 'Migration Completed',
          fields: [
            {
              title: 'Migration ID',
              value: data.migrationId,
              short: true,
            },
            {
              title: 'Duration',
              value: `${durationMinutes}m ${durationSeconds}s`,
              short: true,
            },
            {
              title: 'Migrated Rows',
              value: data.migratedRows.toLocaleString(),
              short: true,
            },
            {
              title: 'Failed Rows',
              value: data.failedRows.toLocaleString(),
              short: true,
            },
            {
              title: 'Tables Completed',
              value: String(data.tablesCompleted),
              short: true,
            },
          ],
          footer: 'SunSetter AQM+',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    await this.sendSlackMessage(message);
  }

  /**
   * Send migration failure notification
   */
  async notifyMigrationFailure(data: {
    migrationId: string;
    error: string;
    tablesCompleted: number;
    tablesFailed: number;
  }): Promise<void> {
    if (!this.config.notifyOnFailure) return;

    const message: SlackMessage = {
      username: this.config.username || 'ConVconV Migration',
      icon_emoji: this.config.iconEmoji || ':x:',
      channel: this.config.channel,
      attachments: [
        {
          color: '#ff0000',
          title: 'Migration Failed',
          text: data.error,
          fields: [
            {
              title: 'Migration ID',
              value: data.migrationId,
              short: true,
            },
            {
              title: 'Tables Completed',
              value: String(data.tablesCompleted),
              short: true,
            },
            {
              title: 'Tables Failed',
              value: String(data.tablesFailed),
              short: true,
            },
          ],
          footer: 'SunSetter AQM+',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    await this.sendSlackMessage(message);
  }

  /**
   * Send table complete notification
   */
  async notifyTableComplete(data: {
    tableName: string;
    migratedRows: number;
    duration: number;
  }): Promise<void> {
    if (!this.config.notifyOnTableComplete) return;

    const durationSeconds = Math.floor(data.duration / 1000);

    const message: SlackMessage = {
      username: this.config.username || 'ConVconV Migration',
      icon_emoji: this.config.iconEmoji || ':white_check_mark:',
      channel: this.config.channel,
      text: `Table \`${data.tableName}\` migrated: ${data.migratedRows.toLocaleString()} rows in ${durationSeconds}s`,
    };

    await this.sendSlackMessage(message);
  }

  /**
   * Send custom notification
   */
  async notify(
    message: string,
    color: 'good' | 'warning' | 'danger' = 'good'
  ): Promise<void> {
    const slackMessage: SlackMessage = {
      username: this.config.username || 'ConVconV Migration',
      icon_emoji: this.config.iconEmoji || ':speech_balloon:',
      channel: this.config.channel,
      attachments: [
        {
          color:
            color === 'good'
              ? '#36a64f'
              : color === 'warning'
                ? '#ff9900'
                : '#ff0000',
          text: message,
          footer: 'SunSetter AQM+',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    await this.sendSlackMessage(slackMessage);
  }

  /**
   * Send message to Slack webhook
   */
  private async sendSlackMessage(
    message: SlackMessage | string
  ): Promise<void> {
    try {
      const payload = typeof message === 'string' ? { text: message } : message;

      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(
          `Failed to send Slack notification: ${response.statusText}`
        );
      }
    } catch (error) {
      console.warn('Failed to send Slack notification:', error);
    }
  }
}
