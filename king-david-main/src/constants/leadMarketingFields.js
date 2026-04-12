export const leadMarketingFields = [
  { key: 'utm_source', label: 'UTM Source', placeholder: 'facebook' },
  { key: 'utm_medium', label: 'UTM Medium', placeholder: 'cpc', numericId: true },
  { key: 'utm_campaign', label: 'UTM Campaign', placeholder: 'campaign_name' },
  { key: 'utm_content', label: 'UTM Content', placeholder: 'creative_a' },
  { key: 'utm_term', label: 'UTM Term', placeholder: 'keyword' },
  { key: 'click_id', label: 'Click ID', placeholder: 'click id', numericId: true },
  { key: 'landing_page', label: 'קישור עמוד נחיתה', placeholder: 'https://...' },
  { key: 'facebook_lead_id', label: 'Facebook Lead ID', placeholder: 'lead id', numericId: true },
  { key: 'facebook_form_id', label: 'Form ID', placeholder: 'form id', numericId: true },
  { key: 'facebook_created_time', label: 'Date created', placeholder: '19/08/2023 08:23' },
  { key: 'facebook_ad_id', label: 'Ad ID', placeholder: 'ad id', numericId: true },
  { key: 'facebook_page_id', label: 'Page ID', placeholder: 'page id', numericId: true },
  { key: 'facebook_ad_group_id', label: 'Ad group ID', placeholder: 'ad group id', numericId: true },
  { key: 'facebook_requested_size', label: 'מה מידת המזרן שאתם מחפשים?', placeholder: '160/200' },
  { key: 'facebook_try_at_home', label: 'איפה תרצו לנסות את המזרן?', placeholder: 'אצלכם בבית' },
  { key: 'facebook_inbox_url', label: 'Inbox URL', placeholder: 'https://...' },
  { key: 'facebook_is_organic', label: 'Is organic', placeholder: 'true / false' },
  { key: 'facebook_ad_name', label: 'Ad name', placeholder: 'ad name' },
  { key: 'facebook_adset_id', label: 'Ad set ID', placeholder: 'adset id', numericId: true },
  { key: 'facebook_adset_name', label: 'Adset name', placeholder: 'adset name' },
  { key: 'facebook_campaign_id', label: 'Campaign ID', placeholder: 'campaign id', numericId: true },
  { key: 'facebook_campaign_name', label: 'Campaign name', placeholder: 'campaign name' },
  { key: 'facebook_custom_disclaimer_responses', label: 'Custom disclaimer responses', placeholder: 'custom disclaimer', multiline: true },
  { key: 'facebook_home_listing', label: 'Home listing', placeholder: 'home listing', multiline: true },
  { key: 'facebook_partner_name', label: 'Partner name', placeholder: 'partner name' },
  { key: 'facebook_platform', label: 'Platform', placeholder: 'facebook / instagram' },
  { key: 'facebook_retailer_item_id', label: 'Retailer item ID', placeholder: 'retailer item id', numericId: true },
  { key: 'facebook_vehicle', label: 'Vehicle', placeholder: 'vehicle', multiline: true },
];

export const leadMarketingFieldLabels = Object.fromEntries(
  leadMarketingFields.map((field) => [field.key, field.label])
);