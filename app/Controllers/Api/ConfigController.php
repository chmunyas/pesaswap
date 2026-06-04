<?php

namespace App\Controllers\Api;

use CodeIgniter\HTTP\ResponseInterface;

class ConfigController extends BaseApiController
{
    public function index(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            $results = $this->db->table('app_config')->get()->getResultArray();
            $config = [];
            foreach ($results as $row) {
                $config[$row['key']] = $row['value'];
            }

            return $this->respondSuccess($config);
        } catch (\Throwable $e) {
            return $this->respondError('Error fetching config: ' . $e->getMessage(), 500);
        }
    }

    public function save(): ResponseInterface
    {
        if ($authResponse = $this->requireAuth()) {
            return $authResponse;
        }

        try {
            $data = $this->getRequestData();

            if (empty($data)) {
                return $this->respondError('No configuration data provided.', 422);
            }

            $builder = $this->db->table('app_config');
            $updated = 0;

            foreach ($data as $key => $value) {
                if (!is_string($key) || strlen($key) > 50) {
                    continue;
                }

                $exists = $builder->where('key', $key)->countAllResults(false);

                if ($exists > 0) {
                    $builder->where('key', $key)->update(['value' => (string)$value]);
                } else {
                    $builder->insert(['key' => $key, 'value' => (string)$value]);
                }
                $updated++;
            }

            return $this->respondSuccess(['updated' => $updated], "Configuration saved ({$updated} keys updated).");
        } catch (\Throwable $e) {
            return $this->respondError('Error saving config: ' . $e->getMessage(), 500);
        }
    }
}
