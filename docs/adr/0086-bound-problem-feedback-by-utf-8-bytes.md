# Bound problem feedback by UTF-8 bytes

Problem-feedback `content` is limited to 256 KiB measured after UTF-8 encoding, with the desktop boundary and server enforcing the same limit. V1 has no product-level word or line limit and shows no counter, but it cannot use PostgreSQL `text` capacity as the safety boundary for an anonymous endpoint; oversized content is rejected without truncation or splitting, and the Agent must shorten it, display the complete new draft, and obtain a new confirmation.
