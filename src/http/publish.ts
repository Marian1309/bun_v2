import { isChannelName } from "@/auth/channel-acl";
import { env } from "@/config/env";
import { to } from "@/core/try-catch";
import { object, string, unknown } from "@/core/validate";
import { publish } from "@/pubsub/broker";

import { hasBearer } from "./bearer";

const STATUS = { accepted: 202, bad_request: 400, unauthorized: 401, not_found: 404 } as const;

const bodySchema = object({ channel: string(), data: unknown() });

type RejectInput = { status: number; reason: string };

const reject = ({ status, reason }: RejectInput): Response => {
  return Response.json({ error: reason }, { status });
};

/** `POST /publish` for trusted backends: bearer `PUBLISH_API_KEY`, body `{ channel, data }`; 404 when no key is set. */
export const handlePublish = async (request: Request): Promise<Response> => {
  const { PUBLISH_API_KEY } = env.http;

  if (PUBLISH_API_KEY === undefined) return reject({ status: STATUS.not_found, reason: "disabled" });
  if (!hasBearer({ request, secret: PUBLISH_API_KEY }))
    return reject({ status: STATUS.unauthorized, reason: "unauthorized" });

  const { data: body } = await to<unknown>(() => request.json());
  const parsed = bodySchema.check(body);

  if (!parsed.ok) return reject({ status: STATUS.bad_request, reason: "invalid_body" });
  if (!isChannelName(parsed.value.channel)) return reject({ status: STATUS.bad_request, reason: "invalid_channel" });

  const { channel, data } = parsed.value;
  const message_id = publish({ channel, data, sender_id: null });

  return Response.json({ message_id }, { status: STATUS.accepted });
};
